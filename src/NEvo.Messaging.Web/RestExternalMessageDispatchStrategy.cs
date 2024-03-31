using LanguageExt;
using NEvo.Messaging.Context;
using NEvo.Messaging.Dispatch.External;
using NEvo.Messaging.Transporting;

namespace NEvo.Messaging.Web;

public class RestExternalMessageDispatchStrategy(
    IRestMessageClientFactory restMessageClientFactory,
    IMessageContextProvider messageContextProvider,
    IMessageEnvelopeMapper messageEnvelopeMapper) : IExternalMessageDispatchStrategy
{
    public Task<Either<Exception, Unit>> DispatchAsync(IMessage message, CancellationToken cancellationToken)
        => messageEnvelopeMapper
            .ToMessageEnvelopeDTO(new MessageEnvelope(message, messageContextProvider.CreateHeaders()))
            .BindAsync(messageEnvelopeDto => restMessageClientFactory
                                                .CreateFor(message)
                                                .DispatchAsync(messageEnvelopeDto, cancellationToken)
            );

    public Task<Either<Exception, TResult>> DispatchAsync<TResult>(IMessage<TResult> message, CancellationToken cancellationToken)
        => messageEnvelopeMapper
            .ToMessageEnvelopeDTO(new MessageEnvelope(message, messageContextProvider.CreateHeaders()))
            .BindAsync(messageEnvelopeDto => restMessageClientFactory
                                                .CreateFor(message)
                                                .DispatchAsync<TResult>(messageEnvelopeDto, cancellationToken)
            );

    public bool ShouldApply(IMessage message) => restMessageClientFactory.ContainConfiguration(message);
}
