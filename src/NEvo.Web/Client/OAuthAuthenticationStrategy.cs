﻿using LanguageExt;
using Microsoft.Extensions.Options;
using System.Net.Http.Headers;
using System.Text.Json;

namespace NEvo.Web.Client;

public record OAuthAuthenticationConfiugration(string TokenEndpoint = "", string ClientId = "", string ClientSecret = "");

public class OAuthAuthenticationStrategy : HttpClientServiceBase, IAuthenticationStrategy
{
    private readonly string _tokenEndpoint;
    private readonly string _clientId;
    private readonly string _clientSecret;

    public OAuthAuthenticationStrategy(IHttpClientServiceFactory httpClientFactory, IOptions<HttpClientServiceConfiguration> options, IOptions<OAuthAuthenticationConfiugration> authOptions)
        : this(httpClientFactory, options, authOptions.Value.TokenEndpoint, authOptions.Value.ClientId, authOptions.Value.ClientSecret)
    {

    }

    public OAuthAuthenticationStrategy(IHttpClientServiceFactory httpClientFactory, IOptions<HttpClientServiceConfiguration> options, string tokenEndpoint, string clientId, string clientSecret) : base(httpClientFactory, options)
    {
        _tokenEndpoint = tokenEndpoint;
        _clientId = clientId;
        _clientSecret = clientSecret;
    }

    public async Task<Either<Exception, HttpClient>> AuthenticateHttpClientAsync(HttpClient client)
        => await GetTokenAsync().MapAsync(token =>
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return client;
        });

    private async Task<Either<Exception, string>> GetTokenAsync()
    {
        // TODO: extend cases
        var requestContent = new FormUrlEncodedContent(
        [
            new KeyValuePair<string, string>("grant_type", "client_credentials"),
            new KeyValuePair<string, string>("client_id", _clientId),
            new KeyValuePair<string, string>("client_secret", _clientSecret),
        ]);

        var request = new HttpRequestMessage(HttpMethod.Post, _tokenEndpoint)
        {
            Content = requestContent
        };

        return await SendAsync(request).BindAsync(ParseResponse);
    }

    private async Task<Either<Exception, string>> ParseResponse(HttpResponseMessage response)
    {
        try
        {
            var responseContent = await response.Content.ReadAsStringAsync();
            var tokenResponse = JsonSerializer.Deserialize<OAuthTokenResponse>(responseContent);
            if (string.IsNullOrEmpty(tokenResponse?.AccessToken))
            {
                return new InvalidOperationException("Token was null or empty.");
            }

            return tokenResponse?.AccessToken!;
        }
        catch (Exception ex)
        {
            return ex;
        }
    }
}
