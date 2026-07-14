// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { CompanyProfileCard } from "./company-profile-card";
import type { CompanyProfileData } from "./finance-schemas";

const BASE: CompanyProfileData = {
	address: null,
	businessScope: "软件开发；技术咨询；技术服务。",
	chairman: "张三",
	csrcIndustry: "计算机、通信和其他电子设备制造业",
	employees: 12_345,
	foundDate: "1990-01-01",
	industry: "半导体",
	listingDate: "2000-01-01",
	market: "深交所",
	name: "示例科技",
	profile: "示例科技是一家专注于半导体设计的公司。",
	regCapital: 100_000_000,
};

it("shows identifying facts and the industry badge always-visible, keeps 简介 behind Expand", () => {
	const { container } = render(<CompanyProfileCard data={BASE} />);
	const scope = within(container);

	expect(scope.getByText("示例科技")).toBeDefined();
	expect(scope.getByText("半导体")).toBeDefined();
	expect(scope.getByText("张三")).toBeDefined();
	expect(scope.queryByText(BASE.profile as string)).toBeNull();

	const toggle = scope.getByText("展开简介");
	fireEvent.click(toggle);

	expect(scope.getByText(BASE.profile as string)).toBeDefined();
	expect(scope.getByText(BASE.businessScope as string)).toBeDefined();
});

it("omits the Expand toggle entirely when both 简介/经营范围 are empty", () => {
	const { container } = render(
		<CompanyProfileCard
			data={{ ...BASE, businessScope: null, profile: null }}
		/>
	);
	const scope = within(container);
	expect(scope.queryByRole("button")).toBeNull();
});
