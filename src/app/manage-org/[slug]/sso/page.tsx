import { SsoProvidersPanel } from "@/components/org/sso-providers-panel";

export default async function OrgSsoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <SsoProvidersPanel slug={slug} />;
}
