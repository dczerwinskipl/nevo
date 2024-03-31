using LanguageExt;
using Microsoft.Extensions.Options;

namespace NEvo.Web.Client;

public abstract class HttpClientServiceBase(IHttpClientServiceFactory httpClientFactory, IOptions<HttpClientServiceConfiguration> options)
{
    protected HttpClientServiceConfiguration _httpClientConfiguration = options.Value;

    protected async Task<Either<Exception, HttpResponseMessage>> SendAsync(HttpRequestMessage request)
        => await httpClientFactory.CreateClientAsync(_httpClientConfiguration.Name)
                    .BindAsync(async client => await SendAsync(client, request));

    private async Task<Either<Exception, HttpResponseMessage>> SendAsync(HttpClient httpClient, HttpRequestMessage request)
    {
        try
        {
            var response = await httpClient.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                // TOOD: add some extractor for details of error
                return new HttpRequestException($"Server returned error code: {response.StatusCode}");
            }
            else
            {
                return response;
            }
        }
        catch (Exception ex)
        {
            return ex;
        }
    }
}
