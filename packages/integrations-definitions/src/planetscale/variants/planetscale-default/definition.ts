import {
  PlanetScaleBaseDefinition,
  type PlanetScaleBaseIntegrationDefinition,
} from "./base-definition.js";
import { PlanetScaleOAuth2AuthorizationCodeCapability } from "./oauth2-authorization-code.server.js";

export const PlanetScaleDefinition: PlanetScaleBaseIntegrationDefinition = {
  ...PlanetScaleBaseDefinition,
  oauth2AuthorizationCode: PlanetScaleOAuth2AuthorizationCodeCapability,
};
