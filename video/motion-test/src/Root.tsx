import { Composition, Still } from "remotion";
import { Poster } from "./Poster";
import { TOTAL_FRAMES } from "./timeline";
import { GrantTraceVideo } from "./Video";

export const Root = () => (
  <>
    <Composition id="GrantTrace" component={GrantTraceVideo} durationInFrames={TOTAL_FRAMES} fps={30} width={1920} height={1080} />
    <Still id="Poster" component={Poster} width={1920} height={1080} />
  </>
);
