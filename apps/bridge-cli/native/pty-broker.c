/*
 * pty-broker — a tiny, dependency-free native helper that owns a real pty on
 * behalf of the Bun CLI. It exists because node-pty is unusable under Bun (both
 * its Node-fd data stream and its dynamically-required `.node` binding break
 * under `bun build --compile`; see docs/research/2026-07-23-node-pty-bun-spike.md).
 *
 * Design (DP-PTY1): the broker `forkpty`s to own the pty master, `execvp`s the
 * requested command inside the pty, and relays over PLAIN PIPES so the Bun side
 * never touches `bun:ffi` (whose variadic `ioctl` is broken on arm64):
 *
 *   fd 0 (stdin)  — host → pty: keystrokes; written verbatim to the pty master.
 *   fd 1 (stdout) — pty → host: raw pty output bytes, forwarded verbatim.
 *   fd 3 (ctl in) — resize control: a 4-byte little-endian frame {rows:u16,
 *                   cols:u16}; the broker calls ioctl(TIOCSWINSZ) natively.
 *   fd 4 (ctl out)— exit control: on child exit the broker writes ONE byte, the
 *                   resolved exit status (raw code, or 128+signum if signalled),
 *                   then closes fd 4 and exits with that same status.
 *
 *   argv: pty-broker <rows> <cols> <command> [args...]
 *
 * Clean shutdown: the broker forwards SIGTERM/SIGINT/SIGHUP to the child's
 * process group (the child is a session leader via forkpty/login_tty) so no
 * orphans survive, then drains and reaps. Closing the pty master also delivers
 * SIGHUP to the child session as a backstop.
 *
 * No third-party deps — libc + libutil (forkpty). Portable across
 * macOS/Linux × arm64/x64.
 */

#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#if defined(__APPLE__)
#include <util.h> /* macOS: forkpty/login_tty live in libSystem (<util.h>) */
#else
#include <pty.h> /* Linux: forkpty lives in libutil (<pty.h>), link -lutil */
#endif

#define CTRL_IN_FD 3
#define CTRL_OUT_FD 4
#define IO_BUF_SIZE 65536
#define RESIZE_FRAME_LEN 4
#define DEFAULT_ROWS 24
#define DEFAULT_COLS 80

/* Set by main so the signal handler can reach the child's process group. The
 * pid doubles as the process-group id because forkpty() calls login_tty()
 * (setsid) in the child, making it a session and group leader. */
static volatile sig_atomic_t g_child_pid = -1;

/* Forward the terminating signal to the whole child process group, so a nested
 * process tree inside the pty tears down instead of orphaning. poll() below
 * returns EINTR after this, the master then reaches EOF, and we reap normally. */
static void forward_signal(int signum) {
	if (g_child_pid > 0) {
		killpg((pid_t)g_child_pid, signum);
	}
}

/* Write the full buffer, retrying short writes and EINTR. Returns 0 on success,
 * -1 if the destination is gone (EPIPE/EBADF) — callers treat that as "stop". */
static int write_all(int fd, const char *buf, size_t len) {
	size_t off = 0;
	while (off < len) {
		ssize_t n = write(fd, buf + off, len - off);
		if (n < 0) {
			if (errno == EINTR) {
				continue;
			}
			return -1;
		}
		off += (size_t)n;
	}
	return 0;
}

/* Parse a bounded non-negative short from argv; falls back to `dflt`. */
static unsigned short parse_dim(const char *s, unsigned short dflt) {
	if (s == NULL || *s == '\0') {
		return dflt;
	}
	char *end = NULL;
	long v = strtol(s, &end, 10);
	if (end == s || v <= 0 || v > 0xFFFF) {
		return dflt;
	}
	return (unsigned short)v;
}

/* Apply a {rows,cols} resize to the pty master. */
static void apply_winsize(int master, unsigned short rows, unsigned short cols) {
	struct winsize ws;
	memset(&ws, 0, sizeof(ws));
	ws.ws_row = rows;
	ws.ws_col = cols;
	ioctl(master, TIOCSWINSZ, &ws);
}

/* Report the child's resolved exit status on fd 4 and return the process exit
 * code the broker itself should use (mirrors the child: raw code, or 128+signum
 * when signalled). */
static int report_exit(int status) {
	int code;
	if (WIFEXITED(status)) {
		code = WEXITSTATUS(status);
	} else if (WIFSIGNALED(status)) {
		code = 128 + WTERMSIG(status);
	} else {
		code = 1;
	}
	unsigned char byte = (unsigned char)(code & 0xFF);
	/* Best-effort: the host may already be gone; ignore write failures. */
	(void)write_all(CTRL_OUT_FD, (const char *)&byte, 1);
	close(CTRL_OUT_FD);
	return code;
}

/* Read up to 4-byte resize frames from the control-in pipe (fd 3) and apply the
 * last complete one. Buffers across partial reads. Returns -1 when fd 3 hits EOF
 * so the caller can stop polling it. */
static int handle_ctrl_in(int master, unsigned char *acc, size_t *acc_len) {
	char chunk[64];
	ssize_t n = read(CTRL_IN_FD, chunk, sizeof(chunk));
	if (n <= 0) {
		if (n < 0 && (errno == EINTR || errno == EAGAIN)) {
			return 0;
		}
		return -1; /* EOF or hard error: stop watching ctrl-in. */
	}
	for (ssize_t i = 0; i < n; i++) {
		acc[*acc_len] = (unsigned char)chunk[i];
		(*acc_len)++;
		if (*acc_len == RESIZE_FRAME_LEN) {
			unsigned short rows = (unsigned short)(acc[0] | (acc[1] << 8));
			unsigned short cols = (unsigned short)(acc[2] | (acc[3] << 8));
			apply_winsize(master, rows, cols);
			*acc_len = 0;
		}
	}
	return 0;
}

/* Copy one readable direction; returns -1 when the source is at EOF/error. */
static int pump(int from, int to) {
	char buf[IO_BUF_SIZE];
	ssize_t n = read(from, buf, sizeof(buf));
	if (n <= 0) {
		if (n < 0 && (errno == EINTR || errno == EAGAIN)) {
			return 0;
		}
		return -1;
	}
	if (write_all(to, buf, (size_t)n) < 0) {
		return -1;
	}
	return 0;
}

int main(int argc, char **argv) {
	if (argc < 4) {
		static const char usage[] =
			"pty-broker: usage: pty-broker <rows> <cols> <command> [args...]\n";
		(void)write_all(2, usage, sizeof(usage) - 1);
		return 2;
	}

	unsigned short rows = parse_dim(argv[1], DEFAULT_ROWS);
	unsigned short cols = parse_dim(argv[2], DEFAULT_COLS);

	struct winsize ws;
	memset(&ws, 0, sizeof(ws));
	ws.ws_row = rows;
	ws.ws_col = cols;

	int master = -1;
	pid_t pid = forkpty(&master, NULL, NULL, &ws);
	if (pid < 0) {
		static const char err[] = "pty-broker: forkpty failed\n";
		(void)write_all(2, err, sizeof(err) - 1);
		return 1;
	}

	if (pid == 0) {
		/* Child: exec the requested command inside the pty. login_tty (done by
		 * forkpty) already made this a session leader with the pty as its
		 * controlling terminal on stdin/stdout/stderr. */
		execvp(argv[3], &argv[3]);
		_exit(127); /* exec failed */
	}

	/* Parent (broker). */
	g_child_pid = pid;

	struct sigaction sa;
	memset(&sa, 0, sizeof(sa));
	sa.sa_handler = forward_signal;
	sigaction(SIGTERM, &sa, NULL);
	sigaction(SIGINT, &sa, NULL);
	sigaction(SIGHUP, &sa, NULL);
	signal(SIGPIPE, SIG_IGN); /* a dead host pipe must not kill the broker */

	unsigned char resize_acc[RESIZE_FRAME_LEN];
	size_t resize_len = 0;

	int stdin_open = 1;
	int ctrl_open = 1;
	int master_open = 1;

	while (master_open) {
		struct pollfd fds[3];
		int idx_stdin = -1;
		int idx_master = -1;
		int idx_ctrl = -1;
		nfds_t nfds = 0;

		fds[nfds].fd = master;
		fds[nfds].events = POLLIN;
		idx_master = (int)nfds;
		nfds++;

		if (stdin_open) {
			fds[nfds].fd = STDIN_FILENO;
			fds[nfds].events = POLLIN;
			idx_stdin = (int)nfds;
			nfds++;
		}
		if (ctrl_open) {
			fds[nfds].fd = CTRL_IN_FD;
			fds[nfds].events = POLLIN;
			idx_ctrl = (int)nfds;
			nfds++;
		}

		int rc = poll(fds, nfds, -1);
		if (rc < 0) {
			if (errno == EINTR) {
				continue; /* a forwarded signal woke us; re-poll. */
			}
			break;
		}

		/* Drain the pty master first so late child output isn't lost. */
		if (idx_master >= 0 && (fds[idx_master].revents & (POLLIN | POLLHUP))) {
			if (pump(master, STDOUT_FILENO) < 0) {
				master_open = 0;
			}
		}
		if (idx_stdin >= 0 && (fds[idx_stdin].revents & (POLLIN | POLLHUP))) {
			if (pump(STDIN_FILENO, master) < 0) {
				stdin_open = 0; /* host closed input; keep the pty running. */
			}
		}
		if (idx_ctrl >= 0 && (fds[idx_ctrl].revents & (POLLIN | POLLHUP))) {
			if (handle_ctrl_in(master, resize_acc, &resize_len) < 0) {
				ctrl_open = 0;
			}
		}
	}

	close(master); /* backstop SIGHUP to the child session */

	int status = 0;
	while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {
		/* retry */
	}

	return report_exit(status);
}
