using System.Text;
using System.Text.Json;
using LanguageExt;
using Microsoft.AspNetCore.WebUtilities;

namespace NEvo.Web.Client.Rest;

public abstract class RestClientBase : HttpClientBase
{
    private const string JsonMediaType = "application/json";

    protected RestClientBase(IHttpClientFactory httpClientFactory) : base(httpClientFactory)
    {
    }

    protected RestClientBase(IHttpClientFactory httpClientFactory, IAuthenticationStrategy authenticationStrategy) : base(httpClientFactory, authenticationStrategy)
    {
    }

    protected async Task<Either<Exception, TResponse>> GetAsync<TResponse>(string url, IDictionary<string, string>? queryParams = null)
    {
        try
        {
            var request = new HttpRequestMessage(HttpMethod.Get, url);
            if (queryParams is not null)
            {
                request.Content = new FormUrlEncodedContent(queryParams);
            }

            return await SendAsync(request).BindAsync(ParseAsync<TResponse>);
        }
        catch (Exception ex)
        {
            return ex;
        }
    }

    protected async Task<Either<Exception, TResponse>> PostAsync<TResponse>(string url, IDictionary<string, string>? queryParams = null)
    {
        try
        {
            if (queryParams is not null)
            {
                url = QueryHelpers.AddQueryString(url, queryParams!);
            }

            var request = new HttpRequestMessage(HttpMethod.Post, url);

            return await SendAsync(request).BindAsync(ParseAsync<TResponse>);
        }
        catch (Exception ex)
        {
            return ex;
        }
    }

    protected async Task<Either<Exception, TResponse>> PostAsync<TRequest, TResponse>(string url, TRequest requestData, IDictionary<string, string>? queryParams = null)
    {
        try
        {
            if (queryParams is not null)
            {
                url = QueryHelpers.AddQueryString(url, queryParams!);
            }

            var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(JsonSerializer.Serialize(requestData), Encoding.UTF8, JsonMediaType)
            };

            return await SendAsync(request).BindAsync(ParseAsync<TResponse>);
        }
        catch (Exception ex)
        {
            return ex;
        }
    }

    protected async Task<Either<Exception, TResponse>> ParseAsync<TResponse>(HttpResponseMessage response)
    {
        try
        {
            var responseContent = await response.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<TResponse>(responseContent)!;
        }
        catch (Exception e)
        {
            return e;
        }
    }
}
