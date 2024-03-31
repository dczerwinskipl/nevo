using NEvo.Messaging.Attribues;

namespace NEvo.ExampleApp.ExampleDomain;

public record MyEvent : Event
{
    public string Foo { get; init; }

    [PartitionKey(Type = "MyEvent")]
    public Guid MyEntity { get; set; }

    public MyEvent(string foo) : base()
    {
        Foo = foo;
    }

    public MyEvent(Guid id, DateTime createdAt, string foo) : base(id, createdAt)
    {
        Foo = foo;
    }
}