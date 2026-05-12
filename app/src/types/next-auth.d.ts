import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      municipalityId?: string;
      avatarUrl?: string;
      role?: string;
      userRoleId?: string;
      isOrgAdmin?: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    idToken?: string;
    municipalityId?: string;
    avatarUrl?: string;
    role?: string;
    userRoleId?: string;
    isOrgAdmin?: boolean;
  }
}
