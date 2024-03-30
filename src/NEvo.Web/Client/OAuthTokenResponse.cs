using System.Text.Json.Serialization;

namespace NEvo.Web.Client;

public class OAuthTokenResponse
{
    [JsonPropertyName("access_token")]
    public string AccessToken { get; set; }

    [JsonConstructor]
    public OAuthTokenResponse(string accessToken)
    {
        AccessToken = accessToken;
    }
}