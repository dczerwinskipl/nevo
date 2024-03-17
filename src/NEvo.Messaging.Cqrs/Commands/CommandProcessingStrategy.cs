using NEvo.Messaging.Handling;
using static LanguageExt.Prelude;

namespace NEvo.Messaging.Cqrs.Commands;

public class CommandProcessingStrategy(IMessageHandlerRegistry messageHandlerRegistry) : IMessageProcessingStrategy
{
    public bool ShouldApply(IMessage message, IMessageContext context) => message is Command;

    public async Task<Either<Exception, Unit>> ProcessMessageAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken)
        => await messageHandlerRegistry
            .GetMessageHandler(message).MatchAsync(
                LeftAsync: async exception => await LeftAsync<Exception, Unit>(exception),
                RightAsync: async handler => (await handler.HandleAsync(message, context, cancellationToken)).Map(obj => (Unit)obj)
            );
}
