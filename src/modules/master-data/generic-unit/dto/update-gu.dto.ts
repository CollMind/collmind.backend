import { PartialType } from '@nestjs/swagger';
import { CreateGuDto } from './create-gu.dto';

export class UpdateGuDto extends PartialType(CreateGuDto) {}
