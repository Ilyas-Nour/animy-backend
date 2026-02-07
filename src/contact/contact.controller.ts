import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Patch,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ContactService } from "./contact.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { Public } from "../common/decorators/public.decorator";

@Controller("contact")
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Public()
  @Post()
  async createContact(@Body() createContactDto: CreateContactDto) {
    return this.contactService.create(createContactDto);
  }

  @Get()
  @UseGuards(AuthGuard("jwt"))
  async getAllContacts() {
    return this.contactService.findAll();
  }

  @Get(":id")
  @UseGuards(AuthGuard("jwt"))
  async getContactById(@Param("id") id: string) {
    return this.contactService.findOne(id);
  }

  @Patch(":id/read")
  @UseGuards(AuthGuard("jwt"))
  async markAsRead(@Param("id") id: string) {
    return this.contactService.markAsRead(id);
  }
}
