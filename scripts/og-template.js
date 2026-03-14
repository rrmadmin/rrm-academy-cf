// scripts/og-template.js
// Satori JSX template for OG images
// Returns a React-element-like object for satori to render

/**
 * @param {string} title - Page title to render
 * @param {string} [description] - Optional description/subtitle
 * @returns {object} Satori-compatible JSX element
 */
export function ogTemplate(title, description) {
  const len = title.length;
  const fontSize = len <= 30 ? 104 : len <= 60 ? 84 : len <= 80 ? 68 : 58;

  // Truncate description to ~120 chars to avoid overflow
  const desc = description && description.length > 120
    ? description.slice(0, 117) + '...'
    : description;

  const titleNode = {
    type: 'span',
    props: {
      style: {
        fontSize: `${fontSize}px`,
        fontWeight: 600,
        color: '#313131',
        lineHeight: 1.2,
      },
      children: title,
    },
  };

  const descNode = desc ? {
    type: 'span',
    props: {
      style: {
        fontSize: '32px',
        fontWeight: 400,
        color: '#636261',
        lineHeight: 1.5,
        marginTop: '16px',
        fontFamily: 'Inter',
      },
      children: desc,
    },
  } : null;

  const titleChildren = desc
    ? [titleNode, descNode]
    : titleNode;

  return {
    type: 'div',
    props: {
      style: {
        width: '1200px',
        height: '630px',
        backgroundColor: '#f7f5f3',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '60px',
        fontFamily: 'Cormorant Garamond',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              flexGrow: 1,
              justifyContent: 'center',
              overflow: 'hidden',
            },
            children: titleChildren,
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              width: '100%',
              height: '2px',
              backgroundColor: '#725e7e',
              marginBottom: '20px',
            },
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            },
            children: [
              {
                type: 'span',
                props: {
                  style: {
                    fontSize: '30px',
                    fontWeight: 600,
                    color: '#725e7e',
                  },
                  children: 'RRM Academy',
                },
              },
              {
                type: 'span',
                props: {
                  style: {
                    fontSize: '22px',
                    fontWeight: 400,
                    color: '#725e7e',
                    fontFamily: 'Inter',
                  },
                  children: 'rrmacademy.org',
                },
              },
            ],
          },
        },
      ],
    },
  };
}
