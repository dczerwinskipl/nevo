using LanguageExt;
using NEvo.Messaging.Handling;
using static LanguageExt.Prelude;

namespace NEvo.Messaging.CQRS.Commands;

public class CommandProcessingStrategy : IMessageProcessingStrategy
{
    private readonly IMessageHandlerRegistry _messageHandlerRegistry;

    public CommandProcessingStrategy(IMessageHandlerRegistry messageHandlerRegistry)
    {
        _messageHandlerRegistry = messageHandlerRegistry;
    }

    public bool ShouldApply(IMessage message, IMessageContext context) => message is Command;

    public async Task<Either<Exception, Unit>> ProcessMessageAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken)
        => await _messageHandlerRegistry
            .GetMessageHandler(message).MatchAsync(
                LeftAsync: async exception => await LeftAsync<Exception, Unit>(exception),
                RightAsync: async handler => //TODO: dalej prez procesor? na razie workaround
                    (await handler.HandleAsync(message, context, cancellationToken)).Map(obj => (Unit)obj)
            );
}
