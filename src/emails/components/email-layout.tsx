import type { ReactNode } from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "react-email";

const APP_NAME = process.env.EMAIL_FROM_NAME || "Sprintify";
const APP_URL = process.env.BETTER_AUTH_URL || "http://localhost:3000";

export function EmailLayout({
  preview,
  heading,
  children,
}: {
  preview: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Img
            src={`${APP_URL}/logos/sprintify-aurora.svg`}
            width="120"
            alt={APP_NAME}
            style={logo}
          />
          <Heading style={headingStyle}>{heading}</Heading>
          <Section>{children}</Section>
          <Hr style={hr} />
          <Text style={footer}>
            {APP_NAME} · This is an automated message, please don&apos;t reply
            to this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const button = {
  backgroundColor: "#471ca8",
  borderRadius: "4px",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 600,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 24px",
  margin: "8px 0 24px",
};

export const destructiveButton = {
  ...button,
  backgroundColor: "#d1105a",
};

export const text = {
  fontSize: "14px",
  lineHeight: "22px",
  color: "#172b4d",
  margin: "0 0 16px",
};

export const link = {
  color: "#471ca8",
  wordBreak: "break-all" as const,
};

const main = {
  backgroundColor: "#f7f8f9",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  padding: "40px 0",
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "32px",
  maxWidth: "480px",
  borderRadius: "6px",
};

const logo = {
  margin: "0 0 24px",
};

const headingStyle = {
  fontSize: "20px",
  fontWeight: 600,
  color: "#172b4d",
  margin: "0 0 16px",
};

const hr = {
  borderColor: "#dfe1e6",
  margin: "32px 0 16px",
};

const footer = {
  fontSize: "12px",
  color: "#626f86",
};
