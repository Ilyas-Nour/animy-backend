import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { CreateContactDto } from "./dto/create-contact.dto";

@Injectable()
export class ContactService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createContactDto: CreateContactDto) {
    const contact = await this.prisma.contact.create({
      data: createContactDto,
    });

    return {
      message: "Contact form submitted successfully",
      contact,
    };
  }

  async findAll() {
    return this.prisma.contact.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
    });

    if (!contact) {
      throw new NotFoundException("Contact not found");
    }

    return contact;
  }

  async markAsRead(id: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
    });

    if (!contact) {
      throw new NotFoundException("Contact not found");
    }

    return this.prisma.contact.update({
      where: { id },
      data: { isRead: true },
    });
  }
}
