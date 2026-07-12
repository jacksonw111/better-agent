import { Badge } from "@better-agent/ui/components/badge";
import type { CompanyProfileData } from "./finance-schemas";
import { formatDate, formatNum } from "./format";
import { CardShell, StatGrid } from "./primitives";

const REG_CAPITAL_DP = 0;

function ProfileParagraph({
	label,
	text,
}: {
	label: string;
	text: string | null;
}) {
	if (!text) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1 pt-1">
			<span className="text-muted-foreground text-xs uppercase tracking-wide">
				{label}
			</span>
			<p className="line-clamp-3 text-foreground text-sm">{text}</p>
		</div>
	);
}

/** finance_company_profile → header (name + industry badge), a StatGrid of
 * identifying facts, then 公司简介 / 经营范围 as clamped paragraphs — this
 * renders inline in chat, not a full F10 page. */
export function CompanyProfileCard({ data }: { data: CompanyProfileData }) {
	return (
		<CardShell
			right={
				data.industry ? <Badge variant="outline">{data.industry}</Badge> : null
			}
			title={data.name}
		>
			<StatGrid
				items={[
					{ label: "证监会行业", value: data.csrcIndustry ?? "—" },
					{ label: "交易市场", value: data.market ?? "—" },
					{ label: "上市日期", value: formatDate(data.listingDate) },
					{ label: "成立日期", value: formatDate(data.foundDate) },
					{ label: "董事长", value: data.chairman ?? "—" },
					{ label: "员工人数", value: formatNum(data.employees, 0) },
					{
						label: "注册资本",
						value: formatNum(data.regCapital, REG_CAPITAL_DP),
					},
				]}
			/>
			<ProfileParagraph label="公司简介" text={data.profile} />
			<ProfileParagraph label="经营范围" text={data.businessScope} />
		</CardShell>
	);
}
