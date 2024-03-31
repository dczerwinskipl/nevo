using LanguageExt;
using NEvo.Messaging.Context;

namespace NEvo.ExampleApp.ServiceA.Api.ExampleDomain;

public class ServiceACommandHandler(IEventPublisher eventPublisher) : ICommandHandler<ServiceACommand>
{
    public async Task<Either<Exception, Unit>> HandleAsync(ServiceACommand message, IMessageContext messageContext, CancellationToken cancellationToken)
    {
        Console.WriteLine(message.Foo);

        return await eventPublisher.PublishAsync(new MyEvent(message.Foo), cancellationToken);
    }
}