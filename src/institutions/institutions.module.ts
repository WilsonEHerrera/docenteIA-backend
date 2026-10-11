import {
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Patch,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Audit, CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

class UpdateInstitutionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;
}

interface InstitutionView {
  id: string;
  name: string;
}

/** Each user belongs to exactly one institution, so the resource is `/institutions/me`. */
@Controller('institutions')
export class InstitutionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser): Promise<InstitutionView> {
    const institution = await this.prisma.institution.findFirst({
      where: { id: user.institutionId, deletedAt: null },
    });
    if (!institution) throw new NotFoundException();
    return { id: institution.id, name: institution.name };
  }

  @Patch('me')
  @Roles(Role.ADMIN)
  @Audit({ action: 'INSTITUTION_UPDATE', resource: 'institution' })
  async update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateInstitutionDto,
  ): Promise<InstitutionView> {
    const institution = await this.prisma.institution.update({
      where: { id: user.institutionId },
      data: { name: dto.name.trim() },
    });
    return { id: institution.id, name: institution.name };
  }
}

@Module({ controllers: [InstitutionsController] })
export class InstitutionsModule {}
