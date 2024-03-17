using LanguageExt;

namespace NEvo.ExampleApp.ExampleDomain;

public class MyCommandHandler(IEventPublisher eventPublisher) : ICommandHandler<MyCommand>
{
    public async Task<Either<Exception, Unit>> HandleAsync(MyCommand message, IMessageContext messageContext, CancellationToken cancellationToken)
    {
        Console.WriteLine(message.Foo);

        return await eventPublisher.PublishAsync(new MyEvent(message.Foo), cancellationToken);
    }
}