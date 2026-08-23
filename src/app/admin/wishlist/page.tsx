import { WishlistRequestsTable } from "@/components/admin/wishlist-requests-table";
import { PageHeader } from "@/components/app/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { getPendingWishlistRequests } from "@/lib/actions/wishlist";

export const dynamic = "force-dynamic";

export default async function AdminWishlistPage() {
  const requests = await getPendingWishlistRequests();
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Platform admin"
        title="Wishlist"
        description="People requesting access while public sign-up is invite only."
      />
      <WishlistRequestsTable requests={requests} />
    </PageContainer>
  );
}
