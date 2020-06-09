const SpotifyWebApi = require("spotify-web-api-node");
const c = require("colors/safe");

exports.pluginName = "Spotify Currently Playing";

const spotifyScopes = ["user-read-playback-state"];
const spotifyState = "USE-SOMETHING-BETTER-HERE"; // TODO, CSRF protection, see https://developer.spotify.com/documentation/general/guides/authorization-guide/
const redirectUri = "/spotify-auth-callback/";
const monitorInterval = 3000; // in milliseconds

exports.onLoad = (pluginConfig, hostUri, router, sendFn) => {
  let spotifyReady = false;
  const { clientId, clientSecret, accessToken, refreshToken } = pluginConfig;

  if (!clientId || !clientSecret) {
    console.log(
      c.red(
        "=> Please provide the following keys in the configuration of the spotify plugin: " +
          "'clientId', 'clientSecret' and 'redirectUri'." +
          "Please refer to Spotify's documentation on how the retrieve these." +
          "As redirect URI please set http://<YOUR HOST>" +
          redirectUri +
          " in Spotify's dashboard."
      )
    );

    process.exit(0);
  }

  const spotApi = new SpotifyWebApi({
    clientId,
    clientSecret,
    redirectUri: hostUri + redirectUri,
  });

  if (accessToken && refreshToken) {
    startTrackMonitor(accessToken, refreshToken);

    return;
  }

  const authUrl = spotApi.createAuthorizeURL(spotifyScopes, spotifyState);
  console.log(
    c.yellow(
      `=> Please open your browser and go to '${authUrl}' to sign into your Spotify account`
    )
  );

  router.get(redirectUri, async (req, res) => {
    const { state, code } = req.query;

    if (state != spotifyState) {
      console.log(
        c.red(`=> Callback route was called with invalid state: '${state}'`)
      );
      // also respond via res
      return;
    }

    if (!code) {
      console.log(
        c.red("=> Callback route was called but no code was provided")
      );
      return;
    }

    try {
      const data = await spotApi.authorizationCodeGrant(code);
      const { expires_in, access_token, refresh_token } = data.body;

      if (!access_token || !refresh_token) {
        console.log(c.red("=> Failed retrieving access and/or refresh token"));
        return;
      }

      pluginConfig.accessToken = access_token;
      pluginConfig.refreshToken = refresh_token;

      console.log(
        `=> Successfully retrieved an access token ('${access_token}'). Expires in ${expires_in} Let's roll!`
      );

      res.send("<body><h1>Successfully signed into Spotify!</h1>");

      startTrackMonitor(access_token, refresh_token);
    } catch (err) {
      console.log(c.red("=> Failed retrieving an access code: "));
      console.log(err);

      res.send("<body><h1>FAILED signing into Spotify!</h1>");
    }
  });

  function startTrackMonitor(accessToken, refreshToken) {
    spotApi.setAccessToken(accessToken);
    spotApi.setRefreshToken(refreshToken);

    const tm = new TrackMonitor(
      spotApi,
      async () => {
        try {
          const response = await spotApi.refreshAccessToken();
          const accessToken = response.body.access_token;

          pluginConfig.accessToken = accessToken;
          spotApi.setAccessToken(accessToken);

          console.log("=> Successfully refreshed the access token.");
        } catch (err) {
          console.log(c.red("=> Could not refresh the access token: "), err);
        }
      },
      (trackInfo, isPlaying) => {
        if (!isPlaying) {
          sendFn("Spotify is currently paused...");
          return;
        }

        const flattenedArtists = trackInfo.artists.reduce(
          (previous, current, idx) => {
            previous = previous + current.name;
            if (idx < trackInfo.artists.length - 1) {
              previous = previous + ", ";
            }
            return previous;
          },
          ""
        );

        sendFn(
          `Playing "${trackInfo.name}" by "${flattenedArtists}" on "${trackInfo.album.name}"`
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

    this.currentState = { item: {} };
  }

  async start() {
    const currentState = await this._getCurrentState();

    if (
      currentState.is_playing !== this.currentState.is_playing ||
      currentState.item.id !== this.currentState.item.id
    ) {
      this.currentState = currentState;

      this.onChange(currentState.item, currentState.is_playing);
    }

    setTimeout(this.start.bind(this), monitorInterval);
  }

  async _getCurrentState() {
    return inner.call(this, 0);

    async function inner(retryCounter) {
      if (retryCounter < 2) {
        try {
          let data = await this.spotApi.getMyCurrentPlaybackState();

          if (data.body.item) {
            return data.body;
          }
        } catch (err) {
          console.log("=> Could not fetch track currently playing: ", err);

          if (err.statusCode == 401) {
            await this.onRefreshToken();

            return inner.call(this, retryCounter++);
          }
        }
      }

      // According to the docs there are cases (204 if no active
      // device and 200 and empty body active device but no playback) in which no data
      // is returned but the call still succeeds.
      // We therefore create a meaning full mock answer instead.
      return { item: {}, is_playing: false };
    }
  }
}
