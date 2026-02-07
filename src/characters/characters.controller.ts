import { Controller, Get, Param, ParseIntPipe } from "@nestjs/common";
import { CharactersService } from "./characters.service";

@Controller()
export class CharactersController {
  constructor(private readonly charactersService: CharactersService) {}

  @Get("characters/birthdays")
  async getBirthdays() {
    return this.charactersService.getBirthdays();
  }

  @Get("characters/:id")
  async getCharacter(@Param("id", ParseIntPipe) id: number) {
    return this.charactersService.getCharacterById(id);
  }
}
