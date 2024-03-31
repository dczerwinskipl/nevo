using LanguageExt;
using Microsoft.Extensions.Options;
using NEvo.Messaging.Transporting;
using NEvo.Web.Client;
using NEvo.Web.Client.Rest;

namespace NEvo.Messaging.Web;

public class RestMessageClientService : RestClientServiceBase, IRestMessageClientService
{
    public RestMessageClientService(IHttpClientServiceFactory httpClientFactory, IOptions<HttpClientServiceConfiguration> options) : base(httpClientFactory, options)
    {
    }

    public Task<Either<Exception, Unit>> DispatchAsync(MessageEnvelopeDto messageEnvelopeDto, CancellationToken cancellationToken)
        => PostAsync<MessageEnvelopeDto, object>("/dispatch", messageEnvelopeDto).MapAsync(o => Unit.Default);

    public Task<Either<Exception, TResult>> DispatchAsync<TResult>(MessageEnvelopeDto messageEnvelopeDto, CancellationToken cancellationToken)
        => PostAsync<MessageEnvelopeDto, TResult>("/dispatch", messageEnvelopeDto);
}
