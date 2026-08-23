import { Img } from "react-email";
import { getUmamiPixelUrl } from "@/lib/pixel";

export type UmamiPixelProps = {
  pixelId?: string;
  hostUrl?: string;
};

/**
 * Invisible tracking pixel for transactional emails using Umami.
 * Reference: https://docs.umami.is/docs/pixels
 *
 * Silently renders nothing if no pixel ID is provided or configured in environment.
 */
export function UmamiPixel({ pixelId, hostUrl }: UmamiPixelProps) {
  const pixelUrl = getUmamiPixelUrl(pixelId, hostUrl);
  if (!pixelUrl) {
    return null;
  }

  return (
    <Img
      src={pixelUrl}
      width="1"
      height="1"
      alt=""
      style={{
        display: "none",
        width: "1px",
        height: "1px",
        border: "none",
        margin: "0",
        padding: "0",
      }}
    />
  );
}
