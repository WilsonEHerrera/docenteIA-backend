import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser, Roles } from '../common/decorators';
import { PaginationQueryDto } from '../common/pagination';
import type { Paginated } from '../common/pagination';
import type { AuthUser } from '../common/types';
import { CreateUserDto, UpdateUserDto, UserView } from './users.dto';
import { UsersService } from './users.service';

@Controller('users')
@Roles(Role.ADMIN)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(
    @CurrentUser() actor: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<UserView>> {
    return this.users.list(actor, query);
  }

  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Body() dto: CreateUserDto,
    @Req() req: Request,
  ): Promise<UserView> {
    return this.users.create(actor, dto, req.ip);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
  ): Promise<UserView> {
    return this.users.update(actor, id, dto, req.ip);
  }

  @Delete(':id/sessions')
  @HttpCode(204)
  revokeSessions(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.users.revokeSessions(actor, id, req.ip);
  }
}
