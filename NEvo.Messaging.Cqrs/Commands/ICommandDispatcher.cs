namespace NEvo.Messaging.Cqrs.Commands;

public interface ICommandDispatcher
{
    Task DispatchAsync(Command command, CancellationToken cancellationToken);
}
