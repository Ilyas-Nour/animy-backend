import { Controller, Get, Param, ParseIntPipe } from "@nestjs/common";
import { PeopleService } from "./people.service";
import { Public } from "../common/decorators/public.decorator";

@Controller("people")
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @Public()
  @Get(":id")
  async getPerson(@Param("id", ParseIntPipe) id: number) {
    const data = await this.peopleService.getPerson(id);
    return data;
  }
}
