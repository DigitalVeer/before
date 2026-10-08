import type { NextConfig } from "next";

/**
 * The dev-server badge floats over the bottom-left of the projected screen and
 * lands in every screenshot. Turn it off so captures show the design only.
 */
const config: NextConfig = {
  devIndicators: false,
};

export default config;
