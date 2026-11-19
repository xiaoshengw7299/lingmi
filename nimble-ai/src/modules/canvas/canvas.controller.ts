import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { AuthUser } from '../../common/types/auth-user';
import { CreateCanvasDto, SaveCanvasDto } from './canvas.dto';
import { CanvasService } from './canvas.service';

@Controller('canvas')
export class CanvasController {
  constructor(private readonly canvas: CanvasService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.canvas.list(String(user.userId));
  }

  @Post()
  create(@Body() dto: CreateCanvasDto, @CurrentUser() user: AuthUser) {
    return this.canvas.create(String(user.userId), dto);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.canvas.get(String(user.userId), id);
  }

  @Put(':id')
  save(@Param('id') id: string, @Body() dto: SaveCanvasDto, @CurrentUser() user: AuthUser) {
    return this.canvas.save(String(user.userId), id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.canvas.remove(String(user.userId), id);
  }
}
