export type ProfileAccount = {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: string | Date;
};

export type ProfileSession = {
  id: string;
  token: string;
  createdAt: string | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};
