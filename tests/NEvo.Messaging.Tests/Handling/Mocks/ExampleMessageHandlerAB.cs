namespace NEvo.Messaging.Tests.Handling.Mocks;

public class ExampleMessageHandlerAB : IExampleMessageHandler<ExampleMessageA>, IExampleMessageHandler<ExampleMessageB>
{
    public void Handle(ExampleMessageA message)
    {
        throw new NotImplementedException();
    }

    public void Handle(ExampleMessageB message)
    {
        throw new NotImplementedException();
    }
}
