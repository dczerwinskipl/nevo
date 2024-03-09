namespace NEvo.Messaging.Tests.Handling.Mocks;

public record ExampleMessageB : ExampleMessage
{
    public ExampleMessageB()
    {
    }

    public ExampleMessageB(Guid Id, DateTime CreatedAt) : base(Id, CreatedAt)
    {
    }
}
