using LanguageExt;
using NEvo.Messaging.Transporting;
using NEvo.Web.Client;
using NEvo.Web.Client.Rest;

namespace NEvo.Messaging.Web;

public class RestMessageClient : RestClientBase, IRestMessageClient
{
    private string _url = ""; // todo: add inject; use factory for it?

    public RestMessageClient(IHttpClientFactory httpClientFactory) : base(httpClientFactory)
    {
    }

    public RestMessageClient(IHttpClientFactory httpClientFactory, IAuthenticationStrategy authenticationStrategy) : base(httpClientFactory, authenticationStrategy)
    {
    }

    public Task<Either<Exception, Unit>> DispatchAsync(MessageEnvelopeDto messageEnvelopeDto, CancellationToken cancellationToken)
        => PostAsync<MessageEnvelopeDto, object>(_url, messageEnvelopeDto).MapAsync(o => Unit.Default);

    public Task<Either<Exception, TResult>> DispatchAsync<TResult>(MessageEnvelopeDto messageEnvelopeDto, CancellationToken cancellationToken)
        => PostAsync<MessageEnvelopeDto, TResult>(_url, messageEnvelopeDto);
}
