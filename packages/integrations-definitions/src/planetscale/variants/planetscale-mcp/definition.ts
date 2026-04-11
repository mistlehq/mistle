import {
  PlanetScaleMcpBaseDefinition,
  type PlanetScaleMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import { PlanetScaleMcpOAuth2AuthorizationCodeCapability } from "./oauth2-authorization-code.server.js";

export const PlanetScaleDefinition: PlanetScaleMcpBaseIntegrationDefinition = {
  ...PlanetScaleMcpBaseDefinition,
  oauth2AuthorizationCode: PlanetScaleMcpOAuth2AuthorizationCodeCapability,
};
