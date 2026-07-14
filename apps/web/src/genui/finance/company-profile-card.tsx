import { Badge } from "@better-agent/ui/components/badge";
import type { CompanyProfileData } from "./finance-schemas";
import { formatDate, formatNum } from "./format";
import type { StatGridItem } from "./primitives";
import { StatPanel } from "./stat-panel";
import type { StatPanelExpandable, StatPanelGroup } from "./stat-panel-types";

const REG_CAPITAL_DP = 0;

/** Full, untruncated paragraph — unlike the old always-visible
 * `line-clamp-3` card, the Expand region has room to show the whole text. */
function ProfileParagraph({ label, text }: { label: string; text: string }) {
	return (
		<div className="flex flex-col gap-1 pt-1">
			<span className="text-muted-foreground text-xs uppercase tracking-wide">
				{label}
			</span>
			<p className="text-foreground text-sm">{text}</p>
		</div>
	);
}

/** `undefined` when both 公司简介/经营范围 are empty, so `StatPanel` renders
 * no Expand toggle at all rather than one that reveals nothing. */
function profileExpandable(
	data: CompanyProfileData
): StatPanelExpandable | undefined {
	if (!(data.profile || data.businessScope)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit undefined keeps eslint consistent-return happy alongside the object return below
		return undefined;
	}
	return {
		content: (
			<>
				{data.profile ? (
					<ProfileParagraph label="公司简介" text={data.profile} />
				) : null}
				{data.businessScope ? (
					<ProfileParagraph label="经营范围" text={data.businessScope} />
				) : null}
			</>
		),
		label: "简介",
	};
}

/** finance_company_profile → StatPanel: identifying facts (证监会行业/交易
 * 市场/上市日期/成立日期/董事长/员工人数/注册资本) always-visible, industry
 * `Badge` in the header's right slot, 公司简介/经营范围 behind Expand
 * ("简介") as full text — this renders inline in chat, not a full F10 page. */
export function CompanyProfileCard({ data }: { data: CompanyProfileData }) {
	const items: StatGridItem[] = [
		{ label: "证监会行业", value: data.csrcIndustry ?? "—" },
		{ label: "交易市场", value: data.market ?? "—" },
		{ label: "上市日期", value: formatDate(data.listingDate) },
		{ label: "成立日期", value: formatDate(data.foundDate) },
		{ label: "董事长", value: data.chairman ?? "—" },
		{ label: "员工人数", value: formatNum(data.employees, 0) },
		{ label: "注册资本", value: formatNum(data.regCapital, REG_CAPITAL_DP) },
	];
	const groups: StatPanelGroup[] = [{ items }];

	return (
		<StatPanel
			expandable={profileExpandable(data)}
			groups={groups}
			right={
				data.industry ? <Badge variant="outline">{data.industry}</Badge> : null
			}
			title={data.name}
		/>
	);
}
