import { MembersPanel } from "@/components/org/members-panel";

export default async function OrgMembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <MembersPanel slug={slug} />;
}
