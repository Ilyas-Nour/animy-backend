import { Controller, Get, Param, ParseIntPipe } from "@nestjs/common";
import { PeopleService } from "./people.service";

@Controller("people")
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @Get(":id")
  async getPerson(@Param("id", ParseIntPipe) id: number) {
    const data = await this.peopleService.getPerson(id);
    return { data };
  }
}
