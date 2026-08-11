using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Tests.Handling;

// D32: HandlerRole is non-nullable and defaults to Primary via a normal `init`
// property, not a new positional constructor parameter — the pre-existing
// six-parameter positional constructor must keep compiling unchanged.
public class MessageHandlerDescriptionTests
{
    [Fact]
    public void Constructor_WithoutMentioningRole_DefaultsToPrimary()
    {
        var description = new MessageHandlerDescription("Key", typeof(object), typeof(object), typeof(object), typeof(void), null);

        description.Role.Should().Be(HandlerRole.Primary);
    }

    [Fact]
    public void ObjectInitializer_CanOverrideRoleToFallback()
    {
        var description = new MessageHandlerDescription("Key", typeof(object), typeof(object), typeof(object)) { Role = HandlerRole.Fallback };

        description.Role.Should().Be(HandlerRole.Fallback);
    }
}
