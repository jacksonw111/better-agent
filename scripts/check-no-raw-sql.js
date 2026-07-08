#!/usr/bin/env node

/**
 * 禁止在 db 层手写 SQL —— 必须使用 drizzle ORM 的 query builder。
 *
 * 检测 `sql\`...\`` 标签模板（drizzle-orm 的 raw-SQL 逃逸口）：任何
 * `db.execute(sql\`...\`)` 或 `sql\`...\`` 表达式都会被拦截。INSERT/UPDATE/
 * SELECT/UPSERT 一律走 `db.insert().values()` / `db.update().set()` /
 * `db.select().from()` / `.onConflictDoUpdate()` 等 builder API。
 *
 * 仅检查 `packages/db/` 下的 .ts/.tsx 暂存文件（"在 db 里"）。注释行跳过。
 */

// biome-ignore-all lint/suspicious/noConsole: CLI 检查脚本，需向终端输出检查结果

import { readFileSync } from "node:fs";

// 匹配 `sql` 紧跟反引号（可含空白）—— 即 sql`...` 标签模板的起点。
// `import { sql }` 没有反引号，不会被误判；`sql.raw()` / `sql.identifier()`
// 这类 builder 辅助也不带反引号，不受影响。
const RAW_SQL_PATTERN = /\bsql\s*`/;

function isCommentLine(line) {
	const trimmed = line.trim();
	return trimmed.startsWith("//") || trimmed.startsWith("*");
}

function checkFile(filePath) {
	try {
		const content = readFileSync(filePath, "utf-8");
		const lines = content.split("\n");
		const issues = [];

		for (const [index, line] of lines.entries()) {
			if (isCommentLine(line)) {
				continue;
			}
			if (RAW_SQL_PATTERN.test(line)) {
				issues.push({
					line: index + 1,
					context: line.trim().slice(0, 80),
				});
			}
		}

		return issues;
	} catch {
		return [];
	}
}

function main() {
	const files = process.argv.slice(2);

	if (files.length === 0) {
		process.exit(0);
	}

	let hasErrors = false;

	for (const file of files) {
		// 只检查 db 层的 TS/TSX 文件
		if (
			!(
				file.includes("packages/db/") &&
				(file.endsWith(".ts") || file.endsWith(".tsx"))
			)
		) {
			continue;
		}

		const issues = checkFile(file);

		if (issues.length > 0) {
			console.error(`\n❌ ${file}`);
			console.error(
				`   发现 ${issues.length} 处手写 SQL (sql\`\` 模板)，db 层必须使用 drizzle ORM builder:\n`
			);

			for (const issue of issues) {
				console.error(`   第 ${issue.line} 行: ${issue.context}`);
			}

			hasErrors = true;
		}
	}

	if (hasErrors) {
		console.error("\n❌ 原始 SQL 检查失败");
		console.error("\n请改用 drizzle ORM 的 query builder：");
		console.error("  db.insert(table).values({...}).onConflictDoUpdate({...})");
		console.error("  db.update(table).set({...}).where(...)");
		console.error("  db.select({ ... }).from(table).where(...).groupBy(...)");
		console.error(
			"\n如需聚合/JSONB，优先用归一化列 + builder；确无 builder 等价物再单独评审。\n"
		);
		process.exit(1);
	}

	console.log("✅ 原始 SQL 检查通过");
	process.exit(0);
}

main();
