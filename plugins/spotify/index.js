const SpotifyWebApi = require("spotify-web-api-node");

exports.pluginName = "Spotify Currently Playing";

const spotifyScopes = ["user-read-playback-state"];
const spotifyState = "USE-SOMETHING-BETTER-HERE"; // TODO, CSRF protection, see https://developer.spotify.com/documentation/general/guides/authorization-guide/
const redirectUri = "/spotify-auth-callback/";
const monitorInterval = 3000; // in milliseconds

exports.onLoad = (pluginConfig, hostUri, router, sendFn) => {
  let spotifyReady = false;
  const { clientId, clientSecret, accessToken } = pluginConfig;

  if (!clientId || !clientSecret) {
    console.log(
      "=> Please provide the following keys in the configuration of the spotify plugin: " +
        "'clientId', 'clientSecret' and 'redirectUri'." +
        "Please refer to Spotify's documentation on how the retrieve these." +
        "As redirect URI please set 'http://<YOUR HOST>" +
        redirectUri +
        "' in Spotify's dashboard."
    );

    process.exit(0);
  }

  const spotApi = new SpotifyWebApi({
    clientId,
    clientSecret,
    redirectUri: hostUri + redirectUri,
  });

  if (accessToken) {
    startTrackMonitor(accessToken, spotApi, sendFn);

    return;
  }

  const authUrl = spotApi.createAuthorizeURL(spotifyScopes, spotifyState);
  console.log(
    `=> Please open your browser and go to '${authUrl}' to sign into your Spotify account`
  );

  router.get(redirectUri, async (req, res) => {
    const { state, code } = req.query;

    if (state != spotifyState) {
      console.log(
        `=> Callback route was called with invalid state: '${state}'`
      );
      // also respond via res
      return;
    }

    if (!code) {
      console.log("=> Callback route was called but no code was provided");
      return;
    }

    try {
      const data = await spotApi.authorizationCodeGrant(code);
      const { expires_in, access_token, refresh_token } = data.body;

      if (!access_token || !refresh_token) {
        console.log("=> Failed retrieving access and/or refresh token");
        return;
      }

      pluginConfig.accessToken = access_token;
      pluginConfig.refreshToken = refresh_token;

      console.log(
        `=> Successfully retrieved an access token ('${access_token}'). Let's roll!`
      );

      res.send("<body><h1>Successfully signed into Spotify!</h1>");

      startTrackMonitor(accessToken, spotApi, sendFn);
    } catch (err) {
      console.log("=> Failed retrieving an access code: ");
      console.log(err);

      res.send("<body><h1>FAILED signing into Spotify!</h1>");
    }
  });

  function startTrackMonitor(accessToken) {
    spotApi.setAccessToken(accessToken);

    const tm = new TrackMonitor(
      spotApi,
      () => {},
      (trackInfo) => {
        const flattenedArtists = trackInfo.artists.reduce(
          (previous, current, idx) => {
            previous = previous + current;
            if (idx < trackInfo.artists.length - 1) {
              previous = previous + ", ";
            }
            return previous;
          },
          ""
        );

        sendFn(
          `Playing '${trackInfo.name}' from '${flattenedArtists}' on '${trackInfo.album.name}'`
        );
      }
    );

    tm.start();
  }
};

class TrackMonitor {
  constructor(spotApi, onRefreshToken, onChange) {
    this.spotApi = spotApi;
    this.onRefreshToken = onRefreshToken;
    this.onChange = onChange;

    this.currentTrack = {};
  }

  async start() {
    const currentTrack = await this._getCurrentTrack();

    if (currentTrack.id != this.currentTrack.id) {
      this.currentTrack = currentTrack;

      this.onChange(currentTrack);
    }

    setTimeout(this.start.bind(this), monitorInterval);
  }

  async _getCurrentTrack() {
    try {
      const data = await this.spotApi.getMyCurrentPlaybackState();

      if (data.statusCode === 204) {
        // nothing currently playing
        return {};
      }

      return data.body.item;
    } catch (err) {
      console.log("=> Could not fetch currently playing track: ", err);
    }
  }
}
