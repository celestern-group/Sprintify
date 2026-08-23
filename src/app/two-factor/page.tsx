import { Suspense } from "react";
import { TwoFactorForm } from "./two-factor-form";

export default function TwoFactorPage() {
  return (
    <Suspense>
      <TwoFactorForm />
    </Suspense>
  );
}
