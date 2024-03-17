﻿using LanguageExt;
using NEvo.Messaging;
using NEvo.Messaging.Cqrs.Events;

namespace NEvo.ExampleApp.ExampleDomain
{
    public class MyEventHandlerB : IEventHandler<MyEvent>
    {
        public Task<Either<Exception, Unit>> HandleAsync(MyEvent message, IMessageContext messageContext, CancellationToken cancellationToken)
        {
            Console.WriteLine($"HandlerB: {message.Foo}");
            throw new Exception(message.Foo);
        }
    }
}