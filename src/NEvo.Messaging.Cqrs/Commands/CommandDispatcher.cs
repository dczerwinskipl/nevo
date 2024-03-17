namespace NEvo.Messaging.Cqrs.Commands;

public class CommandDispatcher(IMessageDispatchStrategyFactory<Command> messageDispatchStrategyFactory) : ICommandDispatcher
{
    public Task<Either<Exception, Unit>> DispatchAsync(Command command, CancellationToken cancellationToken)
    {
        var strategy = messageDispatchStrategyFactory.CreateFor(command);
        return strategy.DispatchAsync(command, cancellationToken);
    }
}
