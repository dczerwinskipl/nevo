using LanguageExt;
using NEvo.Messaging.Transporting;

namespace NEvo.Messaging.Web;

public interface IRestMessageClientService // better name
{
    public Task<Either<Exception, Unit>> DispatchAsync(MessageEnvelopeDto messageEnvelopeDto, CancellationToken cancellationToken);
    public Task<Either<Exception, TResult>> DispatchAsync<TResult>(MessageEnvelopeDto messageEnvelopeDto, CancellationToken cancellationToken);
}
