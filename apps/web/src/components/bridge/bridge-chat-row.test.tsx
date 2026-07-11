// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { BridgeChatRow } from "./bridge-chat-row";
import type { TaskTurn } from "./bridge-turns";

function renderTurn(turn: TaskTurn) {
	const { container } = render(
		<BridgeChatRow
			answered={{}}
			answeredQuestions={{}}
			ended={false}
			onAnswerApproval={() => {
				// no-op for this test
			}}
			onAnswerQuestion={() => {
				// no-op for this test
			}}
			turn={turn}
		/>
	);
	return within(container);
}

it("renders a task turn as a task card, not a blank tool row", () => {
	const turn: TaskTurn = {
		id: 1,
		kind: "task",
		task: {
			callId: "call_1",
			resultText: "explored the project",
			status: "complete",
			title: "Explore project structure",
		},
	};
	const scope = renderTurn(turn);
	expect(scope.getByText("Explore project structure")).toBeDefined();
});
