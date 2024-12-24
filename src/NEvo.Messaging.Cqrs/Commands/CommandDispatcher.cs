using NEvo.Messaging.Context;
using NEvo.Messaging.Dispatching;

namespace NEvo.Messaging.Cqrs.Commands;

public class CommandDispatcher(
    IMessageDispatchStrategyFactory<Command> messageDispatchStrategyFactory,
    IMessageContextAccessor messageContextAccessor,
    IMessageContextProvider messageContextFactory
) : ICommandDispatcher
{
    public Task<Either<Exception, Unit>> DispatchAsync(Command command, CancellationToken cancellationToken)
    {
        var strategy = messageDispatchStrategyFactory.CreateFor(command);
        messageContextAccessor.MessageContext ??= messageContextFactory.CreateContext();

        return strategy.DispatchAsync(
            command,
            messageContextAccessor.MessageContext,
            cancellationToken
        );
    }
}
