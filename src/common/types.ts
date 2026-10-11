import { Role } from '@prisma/client';
import { TracedRequest } from './trace-id.middleware';

export interface AuthUser {
  id: string;
  institutionId: string;
  role: Role;
}

export interface AuthedRequest extends TracedRequest {
  user?: AuthUser;
}
