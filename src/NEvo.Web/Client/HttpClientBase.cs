using LanguageExt;

namespace NEvo.Web.Client;

public abstract class HttpClientBase(IHttpClientFactory httpClientFactory, IAuthenticationStrategy authenticationStrategy)
{
    protected HttpClientBase(IHttpClientFactory httpClientFactory) : this(httpClientFactory, new NoAuthenticationStrategy())
    {

    }

    protected async Task<Either<Exception, HttpClient>> CreateHttpClientAsync()
    {
        var client = httpClientFactory.CreateClient();
        return await authenticationStrategy.AuthenticateHttpClientAsync(client);
    }

    protected async Task<Either<Exception, HttpResponseMessage>> SendAsync(HttpRequestMessage request)
        => await CreateHttpClientAsync()
                    .BindAsync(async client => await SendAsync(client, request));

    private async Task<Either<Exception, HttpResponseMessage>> SendAsync(HttpClient httpClient, HttpRequestMessage request)
    {
        try
        {
            var response = await httpClient.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
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
