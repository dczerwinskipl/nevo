using LanguageExt;
using NEvo.Core;
using NEvo.Messaging;
using NEvo.Messaging.Cqrs.Events;

namespace NEvo.ExampleApp.ExampleDomain
{
    public class MyEventHandlerA : IEventHandler<MyEvent>
    {
        public Task<Either<Exception, Unit>> HandleAsync(MyEvent message, IMessageContext messageContext, CancellationToken cancellationToken)
        {
            Console.WriteLine($"HandlerA: {message.Foo}");

            return UnitExt.DefaultEitherTask;
        }
    }
}