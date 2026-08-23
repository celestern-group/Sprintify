import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StyleguideClient } from "./styleguide-client";

export const metadata: Metadata = {
  title: "Styleguide — Sprintify DS v0.3 — Aurora",
};

export default function StyleguidePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <StyleguideClient />;
}
