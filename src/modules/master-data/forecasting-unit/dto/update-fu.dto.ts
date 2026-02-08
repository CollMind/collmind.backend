import { PartialType } from '@nestjs/swagger';
import { CreateFuDto } from './create-fu.dto';

export class UpdateFuDto extends PartialType(CreateFuDto) {}
